-- #3176 IndexNow outbox happy path (PostgreSQL 17). One rollback-only test.
\set ON_ERROR_STOP on
BEGIN;

DO $security$
BEGIN
  IF has_table_privilege('anon','public.search_indexnow_outbox','SELECT')
     OR has_table_privilege('authenticated','public.search_indexnow_outbox','SELECT') THEN
    RAISE EXCEPTION '#3176: private outbox is readable by an app role';
  END IF;
  IF has_function_privilege('anon','public.list_search_indexnow_batch(integer)','EXECUTE')
     OR has_function_privilege('authenticated','public.record_search_indexnow_delivery(bigint[],boolean,text)','EXECUTE') THEN
    RAISE EXCEPTION '#3176: outbox operations are executable by an app role';
  END IF;
END
$security$;

-- Isolate the outbox trigger contract from #2986's source-readiness trigger;
-- its comprehensive source validation is tested by #2986. The table constraints
-- and this trigger remain real. Transaction rollback restores trigger state.
ALTER TABLE public.public_search_documents DISABLE TRIGGER validate_public_search_document;

INSERT INTO public.public_search_documents(
  id,entity_kind,entity_id,canonical_path,lifecycle_state,validation_checks,
  source_updated_at,verified_at,review_due_at,change_reason,change_source,is_test_record
) VALUES (
  '31760000-0000-4000-8000-000000000000','event','31760000-0000-4000-8000-000000000001','/e/i3176/outbox','public_noindex','{}',
  '2026-09-10T10:00:00Z','2026-09-10T10:00:00Z','2026-10-10T10:00:00Z',
  'outbox test starts noindex','issue_3176_pg',false
);

DO $no_noise$
BEGIN
  IF EXISTS (SELECT 1 FROM public.search_indexnow_outbox) THEN
    RAISE EXCEPTION '#3176: public_noindex insert created IndexNow noise';
  END IF;
END
$no_noise$;

UPDATE public.public_search_documents
SET lifecycle_state='search_ready',change_reason='independent review passed'
WHERE canonical_path='/e/i3176/outbox';

UPDATE public.public_search_documents
SET change_reason='copy-only audit note'
WHERE canonical_path='/e/i3176/outbox';

DO $entered_ready$
BEGIN
  IF (SELECT count(*) FROM public.search_indexnow_outbox WHERE operation='updated')<>1 THEN
    RAISE EXCEPTION '#3176: entering search_ready was not exactly-once';
  END IF;
END
$entered_ready$;

UPDATE public.public_search_documents
SET source_updated_at='2026-09-10T11:00:00Z',change_reason='source version reviewed'
WHERE canonical_path='/e/i3176/outbox';

UPDATE public.public_search_documents
SET lifecycle_state='stale',change_reason='source became stale'
WHERE canonical_path='/e/i3176/outbox';

DO $meaningful$
DECLARE v_ids bigint[];
BEGIN
  IF (SELECT count(*) FROM public.search_indexnow_outbox WHERE operation='updated')<>2
     OR (SELECT count(*) FROM public.search_indexnow_outbox WHERE operation='deleted')<>1 THEN
    RAISE EXCEPTION '#3176: meaningful update/delete transition set is wrong';
  END IF;

  -- Calling the same enqueue again with the same fingerprint is idempotent.
  PERFORM public.enqueue_search_indexnow_url(
    '/e/i3176/outbox','deleted','event','2026-09-10T11:00:00Z','lifecycle-left|stale');
  IF (SELECT count(*) FROM public.search_indexnow_outbox)<>3 THEN
    RAISE EXCEPTION '#3176: duplicate fingerprint created another delivery';
  END IF;

  SELECT array_agg(id ORDER BY id) INTO v_ids FROM public.search_indexnow_outbox;
  IF public.record_search_indexnow_delivery(v_ids,false,'indexnow_http_503')<>3 THEN
    RAISE EXCEPTION '#3176: failure receipt missed rows';
  END IF;
  IF EXISTS (SELECT 1 FROM public.search_indexnow_outbox WHERE delivery_state<>'pending' OR attempt_count<>1 OR last_error_code<>'indexnow_http_503') THEN
    RAISE EXCEPTION '#3176: failure advanced or lost a retryable row';
  END IF;

  UPDATE public.search_indexnow_outbox SET next_attempt_at=now()-interval '1 second';
  IF public.record_search_indexnow_delivery(v_ids,true,NULL)<>3 THEN
    RAISE EXCEPTION '#3176: success receipt missed rows';
  END IF;
  IF EXISTS (SELECT 1 FROM public.search_indexnow_outbox WHERE delivery_state<>'delivered' OR delivered_at IS NULL OR attempt_count<>2 OR last_error_code IS NOT NULL) THEN
    RAISE EXCEPTION '#3176: delivery receipt shape is wrong';
  END IF;
END
$meaningful$;

DO $retention$
BEGIN
  BEGIN
    PERFORM public.prune_delivered_search_indexnow(now()-interval '89 days');
    RAISE EXCEPTION '#3176: retention guard accepted less than 90 days';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
END
$retention$;

ROLLBACK;
\echo 'issue_3176_indexnow_outbox.implementor.happy.pg17: PASS'
