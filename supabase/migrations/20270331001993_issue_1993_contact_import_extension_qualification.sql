-- Issue #1993: repair the already-applied #1775 preview routine without
-- rewriting migration history. Only the pgcrypto call changes: pgcrypto is
-- installed in `extensions`, outside this routine's pinned search_path.
BEGIN;

CREATE OR REPLACE FUNCTION public.issue_1775_store_preview(
 p_batch uuid,p_brand uuid,p_actor uuid,p_inspection_hash text,p_digest text,p_mapping_version text,p_mapping jsonb,p_mapping_digest text,p_preview_hash text,p_attestation_version text,p_attestation text,p_brand_name text,p_rows jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_batch public.brand_contact_import_batches%ROWTYPE; r public.brand_contact_import_rows%ROWTYPE; v_counts jsonb; v_candidates uuid[]; v_person uuid; v_candidate_name text; v_has_new_fact boolean;
BEGIN
 SELECT * INTO v_batch FROM public.brand_contact_import_batches WHERE id=p_batch FOR UPDATE;
 IF NOT FOUND OR v_batch.brand_id<>p_brand OR v_batch.actor_user_id<>p_actor THEN RAISE EXCEPTION 'contact_import_not_found' USING ERRCODE='P0002'; END IF;
 IF v_batch.state<>'inspected' OR v_batch.inspection_expires_at<=now() OR v_batch.inspection_token_hash<>p_inspection_hash OR v_batch.file_sha256<>p_digest THEN RAISE EXCEPTION 'inspection_stale_or_tampered' USING ERRCODE='23514'; END IF;
 DELETE FROM public.brand_contact_import_rows WHERE batch_id=p_batch;
 INSERT INTO public.brand_contact_import_rows(batch_id,row_number,row_fingerprint,duplicate_key,name,email,phone_e164,phone_country,outcome,reason_code,email_suppressed,sms_suppressed,canonical_person_id)
 SELECT p_batch,(x->>'rowNumber')::int,x->>'rowFingerprint',x->>'duplicateKey',NULLIF(x->>'name',''),NULLIF(x->>'email',''),NULLIF(x->>'phoneE164',''),NULLIF(x->>'phoneCountry',''),x->>'outcome',NULLIF(x->>'reasonCode',''),COALESCE((x->>'emailSuppressed')::boolean,false),COALESCE((x->>'smsSuppressed')::boolean,false),NULLIF(x->>'personId','')::uuid
 FROM jsonb_array_elements(p_rows) x;
 IF (SELECT count(*) FROM public.brand_contact_import_rows WHERE batch_id=p_batch)<>v_batch.row_count THEN RAISE EXCEPTION 'contact_import_row_reconciliation' USING ERRCODE='23514'; END IF;
 FOR r IN SELECT * FROM public.brand_contact_import_rows WHERE batch_id=p_batch AND outcome='added' ORDER BY row_number FOR UPDATE LOOP
   SELECT array_agg(DISTINCT c.brand_person_id ORDER BY c.brand_person_id) INTO v_candidates
   FROM public.brand_person_contact_methods c
   JOIN public.brand_people p ON p.id=c.brand_person_id
   WHERE c.brand_id=p_brand AND c.record_state='active' AND p.record_status='active'
     AND ((c.channel='email' AND r.email IS NOT NULL AND c.normalized_value=r.email)
       OR (c.channel='phone' AND r.phone_e164 IS NOT NULL AND c.normalized_value=r.phone_e164));
   IF cardinality(COALESCE(v_candidates,'{}'))>1 THEN
     UPDATE public.brand_contact_import_rows SET outcome='review',reason_code='ambiguous_identity' WHERE id=r.id;
     CONTINUE;
   ELSIF cardinality(COALESCE(v_candidates,'{}'))=1 THEN
     v_person:=v_candidates[1];
     SELECT lower(regexp_replace(btrim(display_name),'\s+',' ','g')) INTO v_candidate_name FROM public.brand_people WHERE id=v_person;
     IF r.name IS NOT NULL AND v_candidate_name<>lower(regexp_replace(btrim(r.name),'\s+',' ','g')) AND v_candidate_name<>'imported contact' THEN
       UPDATE public.brand_contact_import_rows SET outcome='review',reason_code='different_nonempty_names',canonical_person_id=v_person WHERE id=r.id;
       CONTINUE;
     END IF;
     SELECT
       (r.email IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.brand_person_contact_methods WHERE brand_person_id=v_person AND channel='email' AND normalized_value=r.email AND record_state='active'))
       OR (r.phone_e164 IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.brand_person_contact_methods WHERE brand_person_id=v_person AND channel='phone' AND normalized_value=r.phone_e164 AND record_state='active'))
       OR (r.name IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.brand_person_names WHERE brand_person_id=v_person AND normalized_name=lower(regexp_replace(btrim(r.name),'\s+',' ','g')) AND active))
       INTO v_has_new_fact;
     UPDATE public.brand_contact_import_rows SET
       outcome=CASE WHEN v_has_new_fact THEN 'updated' ELSE 'unchanged' END,
       canonical_person_id=v_person,
       email_suppressed=EXISTS(SELECT 1 FROM public.brand_person_channel_suppressions WHERE brand_person_id=v_person AND channel='email' AND lifted_at IS NULL),
       sms_suppressed=EXISTS(SELECT 1 FROM public.brand_person_channel_suppressions WHERE brand_person_id=v_person AND channel='sms' AND lifted_at IS NULL)
     WHERE id=r.id;
   END IF;
 END LOOP;
 SELECT jsonb_build_object('rowCount',count(*),'addedCount',count(*) FILTER(WHERE outcome='added'),'updatedCount',count(*) FILTER(WHERE outcome='updated'),'reviewCount',count(*) FILTER(WHERE outcome='review'),'invalidCount',count(*) FILTER(WHERE outcome='invalid'),'duplicateCount',count(*) FILTER(WHERE outcome='duplicate'),'unchangedCount',count(*) FILTER(WHERE outcome='unchanged'),'alreadySuppressedCount',count(*) FILTER(WHERE email_suppressed OR sms_suppressed)) INTO v_counts FROM public.brand_contact_import_rows WHERE batch_id=p_batch;
 UPDATE public.brand_contact_import_batches SET state='previewed',mapping_version=p_mapping_version,normalized_mapping=p_mapping,mapping_digest=p_mapping_digest,preview_token_hash=p_preview_hash,preview_expires_at=now()+interval '24 hours',inspection_token_hash=encode(extensions.digest(extensions.gen_random_bytes(32),'sha256'),'hex'),attestation_version=p_attestation_version,attestation_text=p_attestation,attested_brand_name=p_brand_name,
 added_count=(v_counts->>'addedCount')::int,updated_count=(v_counts->>'updatedCount')::int,review_count=(v_counts->>'reviewCount')::int,invalid_count=(v_counts->>'invalidCount')::int,duplicate_count=(v_counts->>'duplicateCount')::int,unchanged_count=(v_counts->>'unchangedCount')::int,already_suppressed_count=(v_counts->>'alreadySuppressedCount')::int,updated_at=now() WHERE id=p_batch;
 INSERT INTO public.brand_contact_import_audit(batch_id,brand_id,actor_user_id,action,file_sha256,mapping_digest,count_snapshot) VALUES(p_batch,p_brand,p_actor,'previewed',p_digest,p_mapping_digest,v_counts);
 RETURN v_counts;
END $f$;

REVOKE ALL ON FUNCTION public.issue_1775_store_preview(uuid,uuid,uuid,text,text,text,jsonb,text,text,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1775_store_preview(uuid,uuid,uuid,text,text,text,jsonb,text,text,text,text,text,jsonb) TO service_role;

DO $assert$
DECLARE
  v_proc oid := 'public.issue_1775_store_preview(uuid,uuid,uuid,text,text,text,jsonb,text,text,text,text,text,jsonb)'::regprocedure;
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(v_proc) INTO v_definition;

  IF v_definition !~ 'extensions\.gen_random_bytes\(32\)' THEN
    RAISE EXCEPTION 'issue_1993_preview_entropy_not_extension_qualified';
  END IF;
  IF v_definition ~ '(^|[^[:alnum:]_.])gen_random_bytes[[:space:]]*\(' THEN
    RAISE EXCEPTION 'issue_1993_preview_keeps_unqualified_extension_call';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid=v_proc) THEN
    RAISE EXCEPTION 'issue_1993_preview_security_definer_lost';
  END IF;
  IF (SELECT proconfig FROM pg_proc WHERE oid=v_proc) IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[] THEN
    RAISE EXCEPTION 'issue_1993_preview_search_path_changed';
  END IF;
  IF EXISTS (
       SELECT 1
       FROM pg_proc p,
            LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
       WHERE p.oid=v_proc AND acl.grantee=0 AND acl.privilege_type='EXECUTE'
     )
     OR has_function_privilege('anon',v_proc,'EXECUTE')
     OR has_function_privilege('authenticated',v_proc,'EXECUTE')
     OR NOT has_function_privilege('service_role',v_proc,'EXECUTE') THEN
    RAISE EXCEPTION 'issue_1993_preview_acl_changed';
  END IF;
END $assert$;

COMMIT;
