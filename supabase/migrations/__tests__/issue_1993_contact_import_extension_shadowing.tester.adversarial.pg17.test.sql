\set ON_ERROR_STOP on
BEGIN;

-- A SECURITY DEFINER routine pinned to public,pg_temp must not resolve its
-- entropy source through public. This hostile namesake makes an unqualified
-- gen_random_bytes() call fail while the intended extensions call still works.
CREATE FUNCTION public.gen_random_bytes(integer)
RETURNS bytea
LANGUAGE plpgsql
AS $shadow$
BEGIN
  RAISE EXCEPTION 'issue_1993_public_entropy_shadow_called';
END
$shadow$;

DO $test$
DECLARE
  v_actor uuid := '19930000-0000-4000-8000-000000000011';
  v_brand uuid := '19930000-0000-4000-8000-000000000012';
  v_batch uuid := '19930000-0000-4000-8000-000000000013';
  v_counts jsonb;
BEGIN
  INSERT INTO auth.users(id) VALUES(v_actor);
  INSERT INTO public.creator_accounts(id) VALUES(v_actor);
  INSERT INTO public.brands(id,account_id,name,slug,default_currency)
  VALUES(v_brand,v_actor,'Issue 1993 Shadow Brand','issue-1993-shadow-brand','USD');
  INSERT INTO public.brand_contact_import_batches(
    id,brand_id,actor_user_id,state,file_sha256,file_name,file_size_bytes,
    row_count,original_headers,detected_provider,dialect,
    inspection_token_hash,inspection_expires_at
  ) VALUES(
    v_batch,v_brand,v_actor,'inspected',repeat('1',64),'contacts.csv',64,
    1,'["Email"]'::jsonb,'generic','comma',repeat('2',64),now()+interval '1 hour'
  );

  SELECT public.issue_1775_store_preview(
    v_batch,v_brand,v_actor,repeat('2',64),repeat('1',64),
    'contact-import-mapping-v1','{"Email":"email"}'::jsonb,repeat('3',64),
    repeat('4',64),'contact-import-attestation-v1','rendered legal attestation',
    'Issue 1993 Shadow Brand',
    jsonb_build_array(jsonb_build_object(
      'rowNumber',2,'rowFingerprint',repeat('5',64),'duplicateKey','e:shadow@example.test',
      'name','Shadow Test','email','shadow@example.test','phoneE164',null,
      'phoneCountry',null,'outcome','added','reasonCode',null,
      'emailSuppressed',false,'smsSuppressed',false,'personId',null
    ))
  ) INTO v_counts;

  IF v_counts->>'rowCount' <> '1' OR v_counts->>'addedCount' <> '1' THEN
    RAISE EXCEPTION 'issue_1993_shadow_preview_wrong_counts: %',v_counts;
  END IF;
END
$test$;

ROLLBACK;
