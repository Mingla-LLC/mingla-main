\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_actor uuid := '19930000-0000-4000-8000-000000000001';
  v_brand uuid := '19930000-0000-4000-8000-000000000002';
  v_batch uuid := '19930000-0000-4000-8000-000000000003';
  v_proc oid := 'public.issue_1775_store_preview(uuid,uuid,uuid,text,text,text,jsonb,text,text,text,text,text,jsonb)'::regprocedure;
  v_definition text;
  v_counts jsonb;
BEGIN
  SELECT pg_get_functiondef(v_proc) INTO v_definition;
  IF v_definition ~ '(^|[^[:alnum:]_.])gen_random_bytes[[:space:]]*\(' THEN
    RAISE EXCEPTION 'issue_1993_unqualified_extension_call_survived';
  END IF;
  IF v_definition !~ 'extensions\.gen_random_bytes\(32\)' THEN
    RAISE EXCEPTION 'issue_1993_qualified_entropy_call_missing';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.audit_unqualified_extension_calls()
    WHERE function_signature LIKE 'issue_1775_store_preview(%'
  ) THEN
    RAISE EXCEPTION 'issue_1993_extension_audit_still_flags_preview';
  END IF;

  INSERT INTO auth.users(id) VALUES(v_actor);
  INSERT INTO public.creator_accounts(id) VALUES(v_actor);
  INSERT INTO public.brands(id,account_id,name,slug,default_currency)
  VALUES(v_brand,v_actor,'Issue 1993 Brand','issue-1993-brand','USD');
  INSERT INTO public.brand_contact_import_batches(
    id,brand_id,actor_user_id,state,file_sha256,file_name,file_size_bytes,
    row_count,original_headers,detected_provider,dialect,
    inspection_token_hash,inspection_expires_at
  ) VALUES(
    v_batch,v_brand,v_actor,'inspected',repeat('a',64),'contacts.csv',64,
    1,'["Email"]'::jsonb,'generic','comma',repeat('b',64),now()+interval '1 hour'
  );

  SELECT public.issue_1775_store_preview(
    v_batch,v_brand,v_actor,repeat('b',64),repeat('a',64),
    'contact-import-mapping-v1','{"Email":"email"}'::jsonb,repeat('c',64),
    repeat('d',64),'contact-import-attestation-v1','rendered legal attestation',
    'Issue 1993 Brand',
    jsonb_build_array(jsonb_build_object(
      'rowNumber',2,'rowFingerprint',repeat('e',64),'duplicateKey','e:person@example.test',
      'name','Test Person','email','person@example.test','phoneE164',null,
      'phoneCountry',null,'outcome','added','reasonCode',null,
      'emailSuppressed',false,'smsSuppressed',false,'personId',null
    ))
  ) INTO v_counts;

  IF v_counts->>'rowCount' <> '1' OR v_counts->>'addedCount' <> '1' THEN
    RAISE EXCEPTION 'issue_1993_preview_path_returned_wrong_counts: %',v_counts;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.brand_contact_import_batches
    WHERE id=v_batch AND state='previewed'
      AND inspection_token_hash<>repeat('b',64)
      AND inspection_token_hash~'^[0-9a-f]{64}$'
  ) THEN
    RAISE EXCEPTION 'issue_1993_preview_path_did_not_rotate_entropy';
  END IF;
END $test$;

ROLLBACK;
