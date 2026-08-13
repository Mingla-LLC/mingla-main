\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_before bigint;
BEGIN
  IF has_function_privilege(
    'anon',
    'public.biz_get_brand_person(uuid,uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.biz_add_brand_person(uuid,text,text,text,text,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'T-1774-A1 anonymous role can execute a People RPC';
  END IF;

  SELECT count(*) INTO v_before FROM public.brand_people;
  PERFORM set_config('request.jwt.claim.sub','',true);
  BEGIN
    PERFORM public.biz_get_brand_person(
      '17740000-0000-4000-8000-000000000010',
      '17740000-0000-4000-8000-000000000099'
    );
    RAISE EXCEPTION 'T-1774-A2 unauthenticated detail call returned an oracle';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  IF (SELECT count(*) FROM public.brand_people) <> v_before THEN
    RAISE EXCEPTION 'T-1774-A3 denied detail call mutated People data';
  END IF;
END;
$test$;

ROLLBACK;
SELECT 'issue_1774_people_page.tester.adversarial: PASS' AS result;
