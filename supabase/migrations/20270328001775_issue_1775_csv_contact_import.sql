-- Issue #1775: server-bound CSV contact import. Additive, idempotent, no raw file storage.
BEGIN;

INSERT INTO public.feature_flags(flag_key,is_enabled,description)
VALUES('contact_import_v1',false,'Dark launch: server-bound CSV contact import')
ON CONFLICT(flag_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.brand_contact_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  state text NOT NULL CHECK(state IN ('inspected','previewed','executing','completed','failed','cancelled','expired')),
  file_sha256 text NOT NULL CHECK(file_sha256 ~ '^[0-9a-f]{64}$'),
  file_name text NOT NULL CHECK(octet_length(file_name) BETWEEN 1 AND 255),
  file_size_bytes bigint NOT NULL CHECK(file_size_bytes BETWEEN 1 AND 10485760),
  row_count integer NOT NULL CHECK(row_count BETWEEN 1 AND 10000),
  original_headers jsonb NOT NULL CHECK(jsonb_typeof(original_headers)='array'),
  detected_provider text NOT NULL CHECK(detected_provider IN ('eventbrite','mailchimp','generic')),
  dialect text NOT NULL CHECK(dialect IN ('comma','semicolon','tab')),
  inspection_token_hash text NOT NULL UNIQUE CHECK(inspection_token_hash ~ '^[0-9a-f]{64}$'),
  inspection_expires_at timestamptz NOT NULL,
  mapping_version text,
  normalized_mapping jsonb,
  mapping_digest text CHECK(mapping_digest IS NULL OR mapping_digest ~ '^[0-9a-f]{64}$'),
  preview_token_hash text UNIQUE CHECK(preview_token_hash IS NULL OR preview_token_hash ~ '^[0-9a-f]{64}$'),
  preview_expires_at timestamptz,
  attestation_version text,
  attestation_text text,
  attested_brand_name text,
  attested_by_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  attested_at timestamptz,
  idempotency_key uuid,
  execute_request_hash text CHECK(execute_request_hash IS NULL OR execute_request_hash ~ '^[0-9a-f]{64}$'),
  added_count integer NOT NULL DEFAULT 0 CHECK(added_count>=0),
  updated_count integer NOT NULL DEFAULT 0 CHECK(updated_count>=0),
  review_count integer NOT NULL DEFAULT 0 CHECK(review_count>=0),
  invalid_count integer NOT NULL DEFAULT 0 CHECK(invalid_count>=0),
  duplicate_count integer NOT NULL DEFAULT 0 CHECK(duplicate_count>=0),
  unchanged_count integer NOT NULL DEFAULT 0 CHECK(unchanged_count>=0),
  already_suppressed_count integer NOT NULL DEFAULT 0 CHECK(already_suppressed_count>=0 AND already_suppressed_count<=row_count),
  started_at timestamptz, completed_at timestamptz, failed_at timestamptz,
  cancelled_at timestamptz, failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT issue_1775_attestation_shape CHECK(
    (attestation_version IS NULL AND attestation_text IS NULL AND attested_brand_name IS NULL AND attested_at IS NULL AND attested_by_user_id IS NULL)
    OR (
      attestation_version IS NOT NULL AND attestation_text IS NOT NULL AND attested_brand_name IS NOT NULL
      AND ((attested_at IS NULL AND attested_by_user_id IS NULL) OR (attested_at IS NOT NULL AND attested_by_user_id IS NOT NULL))
    )
  ),
  CONSTRAINT issue_1775_count_reconciliation CHECK(
    state='inspected' OR added_count+updated_count+review_count+invalid_count+duplicate_count+unchanged_count=row_count
  )
);

CREATE TABLE IF NOT EXISTS public.brand_contact_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.brand_contact_import_batches(id) ON DELETE RESTRICT,
  row_number integer NOT NULL CHECK(row_number>=2),
  row_fingerprint text NOT NULL CHECK(row_fingerprint ~ '^[0-9a-f]{64}$'),
  duplicate_key text,
  name text, email text, phone_e164 text, phone_country text,
  outcome text NOT NULL CHECK(outcome IN ('added','updated','review','invalid','duplicate','unchanged')),
  reason_code text,
  email_suppressed boolean NOT NULL DEFAULT false,
  sms_suppressed boolean NOT NULL DEFAULT false,
  canonical_person_id uuid REFERENCES public.brand_people(id) ON DELETE RESTRICT,
  conflict_id uuid REFERENCES public.brand_person_identity_conflicts(id) ON DELETE RESTRICT,
  executed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(batch_id,row_number)
);

CREATE TABLE IF NOT EXISTS public.brand_contact_import_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), batch_id uuid NOT NULL REFERENCES public.brand_contact_import_batches(id) ON DELETE RESTRICT,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK(action IN ('inspected','previewed','attested','execution_started','completed','failed','cancelled','expired','retry_resumed')),
  attestation_version text, attestation_text text, file_sha256 text NOT NULL,
  mapping_digest text, count_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS issue_1775_batches_brand_created ON public.brand_contact_import_batches(brand_id,created_at DESC);
CREATE INDEX IF NOT EXISTS issue_1775_batches_brand_state ON public.brand_contact_import_batches(brand_id,state);
CREATE UNIQUE INDEX IF NOT EXISTS issue_1775_batches_active_inspection_digest
  ON public.brand_contact_import_batches(brand_id,actor_user_id,file_sha256)
  WHERE state='inspected';
CREATE INDEX IF NOT EXISTS issue_1775_rows_batch_outcome ON public.brand_contact_import_rows(batch_id,outcome);
CREATE INDEX IF NOT EXISTS issue_1775_rows_fingerprint ON public.brand_contact_import_rows(batch_id,row_fingerprint);
CREATE INDEX IF NOT EXISTS issue_1775_rows_duplicate_key ON public.brand_contact_import_rows(batch_id,duplicate_key);
CREATE INDEX IF NOT EXISTS issue_1775_rows_person ON public.brand_contact_import_rows(canonical_person_id);
CREATE INDEX IF NOT EXISTS issue_1775_rows_conflict ON public.brand_contact_import_rows(conflict_id);
CREATE INDEX IF NOT EXISTS issue_1775_audit_batch_created ON public.brand_contact_import_audit(batch_id,created_at);

DO $block$ DECLARE v_table text; BEGIN
  FOREACH v_table IN ARRAY ARRAY['brand_contact_import_batches','brand_contact_import_rows'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated',v_table);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role',v_table);
  END LOOP;
  ALTER TABLE public.brand_contact_import_audit ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON TABLE public.brand_contact_import_audit FROM PUBLIC,anon,authenticated,service_role;
  GRANT SELECT,INSERT ON TABLE public.brand_contact_import_audit TO service_role;
END $block$;

CREATE OR REPLACE FUNCTION public.issue_1775_reject_audit_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
BEGIN
  RAISE EXCEPTION 'contact_import_audit_append_only' USING ERRCODE='42501';
END $f$;
REVOKE ALL ON FUNCTION public.issue_1775_reject_audit_mutation() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS issue_1775_audit_append_only ON public.brand_contact_import_audit;
CREATE TRIGGER issue_1775_audit_append_only
BEFORE UPDATE OR DELETE ON public.brand_contact_import_audit
FOR EACH ROW EXECUTE FUNCTION public.issue_1775_reject_audit_mutation();

CREATE OR REPLACE FUNCTION public.issue_1775_import_access_authorized(p_brand_id uuid,p_actor uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $f$
 SELECT p_actor IS NOT NULL
   AND public.biz_brand_effective_rank(p_brand_id,p_actor)>=public.biz_role_rank('marketing_manager')
$f$;
REVOKE ALL ON FUNCTION public.issue_1775_import_access_authorized(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1775_import_access_authorized(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_1775_import_authorized(p_brand_id uuid,p_actor uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $f$
 SELECT public.issue_1775_import_access_authorized(p_brand_id,p_actor)
   AND EXISTS(SELECT 1 FROM public.feature_flags WHERE flag_key='contact_import_v1' AND is_enabled)
$f$;
REVOKE ALL ON FUNCTION public.issue_1775_import_authorized(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1775_import_authorized(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_1775_store_inspection(
 p_brand uuid,p_actor uuid,p_digest text,p_name text,p_size bigint,p_rows int,p_headers jsonb,p_provider text,p_dialect text,p_token_hash text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_id uuid;
BEGIN
 IF NOT public.issue_1775_import_authorized(p_brand,p_actor) THEN RAISE EXCEPTION 'contact_import_forbidden' USING ERRCODE='42501'; END IF;
 IF p_digest!~'^[0-9a-f]{64}$' OR p_token_hash!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'contact_import_invalid_digest' USING ERRCODE='22023'; END IF;
 INSERT INTO public.brand_contact_import_batches(brand_id,actor_user_id,state,file_sha256,file_name,file_size_bytes,row_count,original_headers,detected_provider,dialect,inspection_token_hash,inspection_expires_at)
 VALUES(p_brand,p_actor,'inspected',p_digest,p_name,p_size,p_rows,p_headers,p_provider,p_dialect,p_token_hash,now()+interval '24 hours')
 ON CONFLICT(brand_id,actor_user_id,file_sha256) WHERE state='inspected' DO UPDATE SET
   inspection_token_hash=EXCLUDED.inspection_token_hash,
   inspection_expires_at=EXCLUDED.inspection_expires_at,
   updated_at=now()
 RETURNING id INTO v_id;
 INSERT INTO public.brand_contact_import_audit(batch_id,brand_id,actor_user_id,action,file_sha256,count_snapshot)
 VALUES(v_id,p_brand,p_actor,'inspected',p_digest,jsonb_build_object('rowCount',p_rows));
 RETURN v_id;
END $f$;

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
 UPDATE public.brand_contact_import_batches SET state='previewed',mapping_version=p_mapping_version,normalized_mapping=p_mapping,mapping_digest=p_mapping_digest,preview_token_hash=p_preview_hash,preview_expires_at=now()+interval '24 hours',inspection_token_hash=encode(extensions.digest(gen_random_bytes(32),'sha256'),'hex'),attestation_version=p_attestation_version,attestation_text=p_attestation,attested_brand_name=p_brand_name,
 added_count=(v_counts->>'addedCount')::int,updated_count=(v_counts->>'updatedCount')::int,review_count=(v_counts->>'reviewCount')::int,invalid_count=(v_counts->>'invalidCount')::int,duplicate_count=(v_counts->>'duplicateCount')::int,unchanged_count=(v_counts->>'unchangedCount')::int,already_suppressed_count=(v_counts->>'alreadySuppressedCount')::int,updated_at=now() WHERE id=p_batch;
 INSERT INTO public.brand_contact_import_audit(batch_id,brand_id,actor_user_id,action,file_sha256,mapping_digest,count_snapshot) VALUES(p_batch,p_brand,p_actor,'previewed',p_digest,p_mapping_digest,v_counts);
 RETURN v_counts;
END $f$;

CREATE OR REPLACE FUNCTION public.issue_1775_execute_import(
 p_batch uuid,p_brand uuid,p_actor uuid,p_preview_hash text,p_digest text,p_mapping_digest text,p_attestation_version text,p_attestation text,p_idempotency uuid,p_request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE b public.brand_contact_import_batches%ROWTYPE; r public.brand_contact_import_rows%ROWTYPE; v_person uuid; v_link uuid; v_conflict uuid; v_candidates uuid[]; v_candidate_name text; v_source uuid; v_contact uuid; v_counts jsonb;
BEGIN
 SELECT * INTO b FROM public.brand_contact_import_batches WHERE id=p_batch FOR UPDATE;
 IF NOT FOUND OR b.brand_id<>p_brand OR b.actor_user_id<>p_actor THEN RAISE EXCEPTION 'contact_import_not_found' USING ERRCODE='P0002'; END IF;
 IF b.state='completed' AND b.idempotency_key=p_idempotency AND b.execute_request_hash=p_request_hash THEN RETURN jsonb_build_object('state','completed','counts',jsonb_build_object('rowCount',b.row_count,'addedCount',b.added_count,'updatedCount',b.updated_count,'reviewCount',b.review_count,'invalidCount',b.invalid_count,'duplicateCount',b.duplicate_count,'unchangedCount',b.unchanged_count,'alreadySuppressedCount',b.already_suppressed_count)); END IF;
 IF b.idempotency_key IS NOT NULL AND (b.idempotency_key<>p_idempotency OR b.execute_request_hash<>p_request_hash) THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505'; END IF;
 IF b.state NOT IN ('previewed','failed') OR b.preview_expires_at<=now() OR b.preview_token_hash<>p_preview_hash OR b.file_sha256<>p_digest OR b.mapping_digest<>p_mapping_digest OR b.attestation_version<>p_attestation_version OR b.attestation_text<>p_attestation THEN RAISE EXCEPTION 'preview_stale_or_tampered' USING ERRCODE='23514'; END IF;
 UPDATE public.brand_contact_import_batches SET state='executing',idempotency_key=p_idempotency,execute_request_hash=p_request_hash,attested_by_user_id=p_actor,attested_at=now(),started_at=COALESCE(started_at,now()),updated_at=now() WHERE id=p_batch;
 IF b.state='failed' THEN
   INSERT INTO public.brand_contact_import_audit(batch_id,brand_id,actor_user_id,action,file_sha256,mapping_digest) VALUES(p_batch,p_brand,p_actor,'retry_resumed',b.file_sha256,b.mapping_digest);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.brand_contact_import_audit WHERE batch_id=p_batch AND action='attested') THEN
   INSERT INTO public.brand_contact_import_audit(batch_id,brand_id,actor_user_id,action,attestation_version,attestation_text,file_sha256,mapping_digest) VALUES(p_batch,p_brand,p_actor,'attested',p_attestation_version,p_attestation,b.file_sha256,b.mapping_digest);
 END IF;
 INSERT INTO public.brand_contact_import_audit(batch_id,brand_id,actor_user_id,action,file_sha256,mapping_digest) VALUES(p_batch,p_brand,p_actor,'execution_started',b.file_sha256,b.mapping_digest);
 FOR r IN SELECT * FROM public.brand_contact_import_rows WHERE batch_id=p_batch ORDER BY row_number FOR UPDATE LOOP
   IF r.outcome IN ('invalid','duplicate') THEN CONTINUE; END IF;
   v_source:=r.id; v_person:=NULL; v_conflict:=NULL;
   SELECT array_agg(DISTINCT c.brand_person_id ORDER BY c.brand_person_id) INTO v_candidates FROM public.brand_person_contact_methods c JOIN public.brand_people p ON p.id=c.brand_person_id WHERE c.brand_id=p_brand AND c.record_state='active' AND p.record_status='active' AND ((c.channel='email' AND r.email IS NOT NULL AND c.normalized_value=r.email) OR (c.channel='phone' AND r.phone_e164 IS NOT NULL AND c.normalized_value=r.phone_e164));
   IF cardinality(COALESCE(v_candidates,'{}'))>1 THEN
     INSERT INTO public.brand_person_identity_conflicts(brand_id,source_kind,source_id,candidate_person_ids,reason) VALUES(p_brand,'import',v_source,v_candidates,'manual_review') ON CONFLICT(source_kind,source_id,status) DO UPDATE SET candidate_person_ids=EXCLUDED.candidate_person_ids RETURNING id INTO v_conflict;
     UPDATE public.brand_contact_import_rows SET outcome='review',reason_code='ambiguous_identity',conflict_id=v_conflict,executed_at=now() WHERE id=r.id; CONTINUE;
   ELSIF cardinality(COALESCE(v_candidates,'{}'))=1 THEN v_person:=v_candidates[1];
   ELSE
     IF r.outcome='review' THEN
       INSERT INTO public.brand_person_identity_conflicts(brand_id,source_kind,source_id,candidate_person_ids,reason) VALUES(p_brand,'import',v_source,'{}','manual_review') ON CONFLICT(source_kind,source_id,status) DO UPDATE SET candidate_person_ids=EXCLUDED.candidate_person_ids RETURNING id INTO v_conflict;
       UPDATE public.brand_contact_import_rows SET reason_code='ambiguous_identity',conflict_id=v_conflict,executed_at=now() WHERE id=r.id;
       CONTINUE;
     END IF;
     INSERT INTO public.brand_people(brand_id,display_name) VALUES(p_brand,COALESCE(NULLIF(r.name,''),'Imported contact')) RETURNING id INTO v_person;
   END IF;
   SELECT lower(regexp_replace(btrim(display_name),'\s+',' ','g')) INTO v_candidate_name FROM public.brand_people WHERE id=v_person;
   IF r.name IS NOT NULL AND v_candidate_name<>lower(regexp_replace(btrim(r.name),'\s+',' ','g')) AND v_candidate_name<>'imported contact' THEN
     INSERT INTO public.brand_person_identity_conflicts(brand_id,source_kind,source_id,candidate_person_ids,reason) VALUES(p_brand,'import',v_source,ARRAY[v_person],'different_nonempty_names') ON CONFLICT(source_kind,source_id,status) DO UPDATE SET candidate_person_ids=EXCLUDED.candidate_person_ids RETURNING id INTO v_conflict;
     UPDATE public.brand_contact_import_rows SET outcome='review',reason_code='different_nonempty_names',canonical_person_id=v_person,conflict_id=v_conflict,executed_at=now() WHERE id=r.id; CONTINUE;
   END IF;
   INSERT INTO public.brand_person_source_links(brand_id,brand_person_id,source_kind,source_id,link_method,source_occurred_at) VALUES(p_brand,v_person,'import',v_source,'normalized_address',now()) ON CONFLICT(source_kind,source_id) WHERE detached_at IS NULL DO UPDATE SET updated_at=now() RETURNING id INTO v_link;
   IF r.name IS NOT NULL THEN INSERT INTO public.brand_person_names(brand_person_id,display_name,normalized_name,name_kind,source_link_id) VALUES(v_person,r.name,lower(regexp_replace(btrim(r.name),'\s+',' ','g')),CASE WHEN EXISTS(SELECT 1 FROM public.brand_person_names WHERE brand_person_id=v_person AND active AND name_kind='primary') THEN 'alternate' ELSE 'primary' END,v_link) ON CONFLICT(brand_person_id,normalized_name) WHERE active DO NOTHING; END IF;
   IF r.email IS NOT NULL THEN INSERT INTO public.brand_person_contact_methods(brand_id,brand_person_id,channel,normalized_value,provenance_scope,is_exportable,is_primary) VALUES(p_brand,v_person,'email',r.email,'brand_owned',true,NOT EXISTS(SELECT 1 FROM public.brand_person_contact_methods WHERE brand_person_id=v_person AND channel='email' AND record_state='active')) ON CONFLICT(brand_person_id,channel,normalized_value) WHERE record_state='active' DO UPDATE SET is_exportable=true,updated_at=now() RETURNING id INTO v_contact; INSERT INTO public.brand_person_contact_method_sources(contact_method_id,source_link_id,provenance_kind,exportable) VALUES(v_contact,v_link,'import',true) ON CONFLICT DO NOTHING; END IF;
   IF r.phone_e164 IS NOT NULL THEN INSERT INTO public.brand_person_contact_methods(brand_id,brand_person_id,channel,normalized_value,provenance_scope,is_exportable,is_primary) VALUES(p_brand,v_person,'phone',r.phone_e164,'brand_owned',true,NOT EXISTS(SELECT 1 FROM public.brand_person_contact_methods WHERE brand_person_id=v_person AND channel='phone' AND record_state='active')) ON CONFLICT(brand_person_id,channel,normalized_value) WHERE record_state='active' DO UPDATE SET is_exportable=true,updated_at=now() RETURNING id INTO v_contact; INSERT INTO public.brand_person_contact_method_sources(contact_method_id,source_link_id,provenance_kind,exportable) VALUES(v_contact,v_link,'import',true) ON CONFLICT DO NOTHING; END IF;
   UPDATE public.brand_contact_import_rows SET
     canonical_person_id=v_person,
     email_suppressed=EXISTS(SELECT 1 FROM public.brand_person_channel_suppressions WHERE brand_person_id=v_person AND channel='email' AND lifted_at IS NULL),
     sms_suppressed=EXISTS(SELECT 1 FROM public.brand_person_channel_suppressions WHERE brand_person_id=v_person AND channel='sms' AND lifted_at IS NULL),
     executed_at=now()
   WHERE id=r.id;
 END LOOP;
 SELECT jsonb_build_object('rowCount',count(*),'addedCount',count(*) FILTER(WHERE outcome='added'),'updatedCount',count(*) FILTER(WHERE outcome='updated'),'reviewCount',count(*) FILTER(WHERE outcome='review'),'invalidCount',count(*) FILTER(WHERE outcome='invalid'),'duplicateCount',count(*) FILTER(WHERE outcome='duplicate'),'unchangedCount',count(*) FILTER(WHERE outcome='unchanged'),'alreadySuppressedCount',count(*) FILTER(WHERE email_suppressed OR sms_suppressed)) INTO v_counts FROM public.brand_contact_import_rows WHERE batch_id=p_batch;
 UPDATE public.brand_contact_import_batches SET state='completed',completed_at=now(),
   added_count=(v_counts->>'addedCount')::int,updated_count=(v_counts->>'updatedCount')::int,review_count=(v_counts->>'reviewCount')::int,
   invalid_count=(v_counts->>'invalidCount')::int,duplicate_count=(v_counts->>'duplicateCount')::int,unchanged_count=(v_counts->>'unchangedCount')::int,
   already_suppressed_count=(v_counts->>'alreadySuppressedCount')::int,updated_at=now() WHERE id=p_batch;
 INSERT INTO public.brand_contact_import_audit(batch_id,brand_id,actor_user_id,action,file_sha256,mapping_digest,count_snapshot) VALUES(p_batch,p_brand,p_actor,'completed',b.file_sha256,b.mapping_digest,v_counts);
 RETURN jsonb_build_object('state','completed','counts',v_counts);
END $f$;

CREATE OR REPLACE FUNCTION public.issue_1775_mark_failed(
 p_batch uuid,p_brand uuid,p_actor uuid,p_idempotency uuid,p_request_hash text,p_failure_code text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE b public.brand_contact_import_batches%ROWTYPE;
BEGIN
 SELECT * INTO b FROM public.brand_contact_import_batches WHERE id=p_batch FOR UPDATE;
 IF NOT FOUND OR b.brand_id<>p_brand OR b.actor_user_id<>p_actor THEN RETURN false; END IF;
 IF b.state NOT IN ('previewed','executing','failed') THEN RETURN false; END IF;
 IF b.idempotency_key IS NOT NULL AND (b.idempotency_key<>p_idempotency OR b.execute_request_hash<>p_request_hash) THEN RETURN false; END IF;
 UPDATE public.brand_contact_import_batches SET state='failed',idempotency_key=p_idempotency,execute_request_hash=p_request_hash,
   failure_code=left(COALESCE(NULLIF(p_failure_code,''),'EXECUTION_FAILED'),80),failed_at=now(),updated_at=now()
 WHERE id=p_batch;
 INSERT INTO public.brand_contact_import_audit(batch_id,brand_id,actor_user_id,action,file_sha256,mapping_digest)
 VALUES(p_batch,p_brand,p_actor,'failed',b.file_sha256,b.mapping_digest);
 RETURN true;
END $f$;

CREATE OR REPLACE FUNCTION public.issue_1775_cancel_import(p_batch uuid,p_brand uuid,p_actor uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_state text; v_digest text; BEGIN
 UPDATE public.brand_contact_import_batches SET state='cancelled',cancelled_at=now(),updated_at=now() WHERE id=p_batch AND brand_id=p_brand AND actor_user_id=p_actor AND state IN('inspected','previewed') RETURNING state,file_sha256 INTO v_state,v_digest;
 IF v_state IS NULL THEN RAISE EXCEPTION 'cannot_cancel_execution' USING ERRCODE='23514'; END IF;
 INSERT INTO public.brand_contact_import_audit(batch_id,brand_id,actor_user_id,action,file_sha256) VALUES(p_batch,p_brand,p_actor,'cancelled',v_digest); RETURN v_state;
END $f$;

CREATE OR REPLACE FUNCTION public.issue_1775_expire_import(
 p_batch uuid,p_brand uuid,p_actor uuid,p_token_hash text,p_expected_state text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE b public.brand_contact_import_batches%ROWTYPE; v_expired boolean:=false;
BEGIN
 SELECT * INTO b FROM public.brand_contact_import_batches WHERE id=p_batch FOR UPDATE;
 IF NOT FOUND OR b.brand_id<>p_brand OR b.actor_user_id<>p_actor THEN RETURN false; END IF;
 IF p_expected_state='inspected' AND b.state='inspected' AND b.inspection_token_hash=p_token_hash AND b.inspection_expires_at<=now() THEN v_expired:=true; END IF;
 IF p_expected_state='previewed' AND b.state IN('previewed','failed') AND b.preview_token_hash=p_token_hash AND b.preview_expires_at<=now() THEN v_expired:=true; END IF;
 IF NOT v_expired THEN RETURN false; END IF;
 UPDATE public.brand_contact_import_batches SET state='expired',updated_at=now() WHERE id=p_batch;
 IF NOT EXISTS(SELECT 1 FROM public.brand_contact_import_audit WHERE batch_id=p_batch AND action='expired') THEN
   INSERT INTO public.brand_contact_import_audit(batch_id,brand_id,actor_user_id,action,file_sha256,mapping_digest)
   VALUES(p_batch,p_brand,p_actor,'expired',b.file_sha256,b.mapping_digest);
 END IF;
 RETURN true;
END $f$;

DO $block$ DECLARE p regprocedure; BEGIN
 FOR p IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'issue_1775_%' AND proname<>'issue_1775_reject_audit_mutation' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',p); EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',p); END LOOP;
END $block$;

DO $assert$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relname='brand_contact_import_batches' AND relrowsecurity) THEN RAISE EXCEPTION 'issue_1775_batches_rls_missing'; END IF;
 IF EXISTS(SELECT 1 FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name LIKE 'brand_contact_import_%' AND grantee IN('anon','authenticated') AND privilege_type IN('INSERT','UPDATE','DELETE')) THEN RAISE EXCEPTION 'issue_1775_client_mutation_grant'; END IF;
END $assert$;
COMMIT;
