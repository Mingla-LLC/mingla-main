\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_signature text := 'public.biz_add_brand_person(uuid,text,text,text,text,uuid)';
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(v_signature::regprocedure) INTO v_definition;
  IF v_definition NOT LIKE '%extensions.digest(%'
    OR v_definition LIKE '%encode(digest(%' THEN
    RAISE EXCEPTION 'T-1774-DIGEST-01 digest is not extension-qualified';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM pg_proc p
    WHERE p.oid=to_regprocedure(v_signature)
      AND p.prosecdef
      AND p.proconfig @> ARRAY['search_path=public, pg_temp']::text[]
  ) OR has_function_privilege('anon',v_signature,'EXECUTE')
    OR NOT has_function_privilege('authenticated',v_signature,'EXECUTE') THEN
    RAISE EXCEPTION 'T-1774-DIGEST-02 function security or ACL drift';
  END IF;
END;
$test$;

ROLLBACK;
SELECT 'issue_1774_people_digest_qualification: PASS' AS result;
