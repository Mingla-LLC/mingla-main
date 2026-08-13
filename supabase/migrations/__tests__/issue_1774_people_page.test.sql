\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id) VALUES
  ('17740000-0000-4000-8000-000000000001'),
  ('17740000-0000-4000-8000-000000000002');
INSERT INTO public.creator_accounts(id,email) VALUES
  ('17740000-0000-4000-8000-000000000001','owner-1774@example.test'),
  ('17740000-0000-4000-8000-000000000002','other-1774@example.test');
INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at) VALUES
  ('17740000-0000-4000-8000-000000000010','17740000-0000-4000-8000-000000000001','People Brand','issue-1774-people','USD',now(),now()),
  ('17740000-0000-4000-8000-000000000011','17740000-0000-4000-8000-000000000002','Other Brand','issue-1774-other','USD',now(),now());

DO $test$
DECLARE
  v_first jsonb; v_replay jsonb; v_book jsonb; v_detail jsonb; v_person uuid;
  v_request uuid := '17740000-0000-4000-8000-000000000040';
  v_before bigint;
BEGIN
  IF has_function_privilege('anon','public.biz_get_brand_people_book(uuid,text,jsonb,integer)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.biz_get_brand_people_book(uuid,text,jsonb,integer)','EXECUTE')
     OR has_table_privilege('authenticated','public.brand_person_manual_add_requests','SELECT')
     OR EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='brand_person_manual_add_requests') THEN
    RAISE EXCEPTION 'T-1774-00 ACL or deny-all ledger drift';
  END IF;

  SELECT count(*) INTO v_before FROM public.brand_people;
  PERFORM set_config('request.jwt.claim.sub','17740000-0000-4000-8000-000000000002',true);
  BEGIN
    PERFORM public.biz_get_brand_people_book('17740000-0000-4000-8000-000000000010',NULL,NULL,50);
    RAISE EXCEPTION 'T-1774-01 cross-brand read accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.biz_add_brand_person('17740000-0000-4000-8000-000000000010','Mallory','mallory@example.test',NULL,NULL,gen_random_uuid());
    RAISE EXCEPTION 'T-1774-01 cross-brand write accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF (SELECT count(*) FROM public.brand_people)<>v_before THEN RAISE EXCEPTION 'T-1774-01 forbidden call mutated'; END IF;

  PERFORM set_config('request.jwt.claim.sub','17740000-0000-4000-8000-000000000001',true);
  v_first := public.biz_add_brand_person('17740000-0000-4000-8000-000000000010','Ada Lovelace',' ADA@Example.Test ',NULL,NULL,v_request);
  v_replay := public.biz_add_brand_person('17740000-0000-4000-8000-000000000010','Ada Lovelace',' ADA@Example.Test ',NULL,NULL,v_request);
  v_person := (v_first->'person'->>'personId')::uuid;
  IF v_first->>'outcome'<>'created' OR v_replay IS DISTINCT FROM v_first
     OR (SELECT count(*) FROM public.brand_person_manual_add_requests WHERE client_request_id=v_request)<>1
     OR (SELECT count(*) FROM public.brand_people WHERE id=v_person)<>1 THEN
    RAISE EXCEPTION 'T-1774-02 create/replay is not idempotent: % / %',v_first,v_replay;
  END IF;

  v_book := public.biz_get_brand_people_book('17740000-0000-4000-8000-000000000010',E'ada\\_%',NULL,50);
  IF (v_book->>'bookTotal')::int<>1 OR (v_book->>'filteredTotal')::int<>0 OR jsonb_array_length(v_book->'rows')<>0 THEN
    RAISE EXCEPTION 'T-1774-03 literal search or totals drift: %',v_book;
  END IF;
  v_book := public.biz_get_brand_people_book('17740000-0000-4000-8000-000000000010','ada',NULL,50);
  IF (v_book->>'bookTotal')::int<>1 OR (v_book->>'filteredTotal')::int<>1 OR v_book->'rows'->0->>'displayName'<>'Ada Lovelace' THEN
    RAISE EXCEPTION 'T-1774-03 list contract drift: %',v_book;
  END IF;
  v_detail := public.biz_get_brand_person('17740000-0000-4000-8000-000000000010',v_person);
  IF v_detail->>'personId'<>v_person::text OR v_detail->'contacts'->0->>'value'<>'ada@example.test' THEN
    RAISE EXCEPTION 'T-1774-04 detail contract drift: %',v_detail;
  END IF;

  BEGIN
    PERFORM public.biz_add_brand_person('17740000-0000-4000-8000-000000000010','Changed','ada@example.test',NULL,NULL,v_request);
    RAISE EXCEPTION 'T-1774-05 changed replay accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
END;
$test$;

ROLLBACK;
SELECT 'issue_1774_people_page: PASS' AS result;
