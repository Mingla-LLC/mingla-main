-- #3720 Support -> Product bridge executable contract.
-- Runs after migration replay against a disposable PostgreSQL 17 database.
-- [TEST-MOD #4382] Staff threads are internal support tickets
-- (issue_4382_create_staff_ticket); the private-workflow guarantees still hold.
-- MINGLA-INVARIANT: I-3720-SUPPORT-PRODUCT-PRIVATE | issue #3720 | Internal support tickets and product signals are readable only by enabled support staff or admins and mutate only through gated RPCs.
-- MINGLA-INVARIANT: I-3720-NEXT-UPDATE-HONEST | issue #3720 | Staff-created tickets and product signals require a future update promise, while live-chat promises create a customer-visible system event.
-- MINGLA-INVARIANT: I-3720-PRODUCT-SIGNAL-NO-GITHUB-WRITE | issue #3720 | Product signals remain private Mingla records and this slice exposes no GitHub write path or browser mutation grant.
BEGIN;

DO $test$
DECLARE
  v_admin constant uuid := '37200000-0000-4000-8000-0000000000ad';
  v_outsider constant uuid := '37200000-0000-4000-8000-0000000000ff';
  v_thread uuid;
  v_thread_two uuid;
  v_replay uuid;
  v_signal uuid;
  v_revision integer;
  v_forbidden boolean := false;
  v_stale boolean := false;
  v_duplicate boolean := false;
BEGIN
  INSERT INTO auth.users(id, email)
  VALUES
    (v_admin, 'admin-3720-bridge@example.test'),
    (v_outsider, 'outsider-3720-bridge@example.test');

  INSERT INTO public.admin_users(email, role, status)
  VALUES ('admin-3720-bridge@example.test', 'admin', 'active')
  ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

  v_thread := public.issue_4382_create_staff_ticket(
    '37200000-0000-4000-8000-000000000101', 'internal',
    'Host cannot find published content',
    'Support recorded the report during a call.',
    NULL, NULL, NULL, 'high', NULL, NULL,
    now() + interval '1 day',
    'Support will confirm the publishing state.', NULL, ARRAY[]::uuid[]
  );
  v_replay := public.issue_4382_create_staff_ticket(
    '37200000-0000-4000-8000-000000000101', 'internal',
    'Host cannot find published content',
    'Support recorded the report during a call.',
    NULL, NULL, NULL, 'high', NULL, NULL,
    now() + interval '1 day',
    'Support will confirm the publishing state.', NULL, ARRAY[]::uuid[]
  );
  IF v_thread IS DISTINCT FROM v_replay THEN
    RAISE EXCEPTION 'create_internal_thread_not_idempotent';
  END IF;

  v_revision := public.issue_3720_set_next_update(
    'support_ticket', v_thread, 1, now() + interval '2 days',
    'Support will return with Product triage.'
  );
  IF v_revision <> 2 THEN
    RAISE EXCEPTION 'next_update_revision_expected_2_got_%', v_revision;
  END IF;

  BEGIN
    PERFORM public.issue_3720_set_next_update(
      'support_ticket', v_thread, 1, now() + interval '3 days', 'A stale promise');
  EXCEPTION WHEN sqlstate 'PT409' THEN
    v_stale := true;
  END;
  IF NOT v_stale THEN
    RAISE EXCEPTION 'stale_internal_update_did_not_fail_closed';
  END IF;

  v_signal := public.issue_3720_create_product_signal(
    '37200000-0000-4000-8000-000000000102',
    'support_ticket',
    v_thread,
    'bug',
    'Published content is missing',
    'A host reports that published content is not visible.',
    'Host app / Content calendar',
    'The host publishes a scheduled card and then checks the board.',
    'The host cannot confirm that their planned post is ready.',
    1,
    'high',
    now() + interval '2 days',
    'Product confirms whether the report is a defect or setup issue.',
    'We are checking the publishing state and will update you after Product review.'
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.support_product_signal_sources
     WHERE signal_id = v_signal AND source_kind = 'support_ticket' AND source_id = v_thread
  ) THEN
    RAISE EXCEPTION 'signal_source_link_missing';
  END IF;

  v_thread_two := public.issue_4382_create_staff_ticket(
    '37200000-0000-4000-8000-000000000105', 'internal',
    'Second host reports missing content',
    'A second report should aggregate into the same Product signal.',
    NULL, NULL, NULL, 'normal', NULL, NULL, now() + interval '1 day',
    'Support will follow the shared Product signal.', NULL, ARRAY[]::uuid[]
  );
  v_revision := public.issue_3720_link_product_signal_source(
    v_signal, 1, 'support_ticket', v_thread_two
  );
  IF v_revision <> 2
     OR (SELECT affected_people FROM public.support_product_signals WHERE id = v_signal) <> 2
     OR (SELECT count(*) FROM public.support_product_signal_sources WHERE signal_id = v_signal) <> 2 THEN
    RAISE EXCEPTION 'many_reports_one_signal_contract_failed';
  END IF;

  BEGIN
    PERFORM public.issue_3720_create_product_signal(
      '37200000-0000-4000-8000-000000000103',
      'support_ticket', v_thread, 'bug', 'Duplicate source', 'Duplicate source',
      'Host app', 'Publish', 'Blocked', 1, 'normal', now() + interval '1 day',
      'Review', 'We are reviewing this.'
    );
  EXCEPTION WHEN unique_violation THEN
    v_duplicate := true;
  END;
  IF NOT v_duplicate THEN
    RAISE EXCEPTION 'source_linked_to_multiple_signals';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_outsider::text, true);
  BEGIN
    PERFORM public.issue_4382_create_staff_ticket(
      '37200000-0000-4000-8000-000000000104', 'internal', 'Forbidden', 'Forbidden outsider',
      NULL, NULL, NULL, 'normal', NULL, NULL, now() + interval '1 day', 'No access', NULL, ARRAY[]::uuid[]
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_forbidden := true;
  END;
  IF NOT v_forbidden THEN
    RAISE EXCEPTION 'non_operator_created_internal_thread';
  END IF;
  IF (SELECT count(*) FROM public.support_tickets) <> 0
     OR (SELECT count(*) FROM public.support_product_signals) <> 0
     OR (SELECT count(*) FROM public.support_product_signal_sources) <> 0
     OR (SELECT count(*) FROM public.support_product_workflow_audit) <> 0 THEN
    RAISE EXCEPTION 'private_workflow_rows_visible_to_outsider';
  END IF;

  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);

  IF EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         'issue_3720_support_operator_required',
         'issue_4382_create_staff_ticket',
         'issue_3720_set_next_update',
         'issue_3720_create_product_signal',
         'issue_3720_update_product_signal',
         'issue_3720_link_product_signal_source'
       )
       AND has_function_privilege('anon', p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'anonymous_workflow_execute_exposed';
  END IF;

  IF has_table_privilege('authenticated', 'public.support_tickets', 'UPDATE') THEN
    RAISE EXCEPTION 'browser_mutation_privilege_exposed:support_tickets_update';
  END IF;
  IF has_table_privilege('authenticated', 'public.support_tickets', 'INSERT') THEN
    RAISE EXCEPTION 'browser_mutation_privilege_exposed:support_tickets_insert';
  END IF;
  IF has_table_privilege('authenticated', 'public.support_product_signals', 'UPDATE') THEN
    RAISE EXCEPTION 'browser_mutation_privilege_exposed:product_signals_update';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND (
       NOT EXISTS (
         SELECT 1 FROM pg_publication_tables
          WHERE pubname = 'supabase_realtime'
            AND schemaname = 'public'
            AND tablename = 'support_tickets'
       )
       OR NOT EXISTS (
         SELECT 1 FROM pg_publication_tables
          WHERE pubname = 'supabase_realtime'
            AND schemaname = 'public'
            AND tablename = 'support_product_signals'
       )
     ) THEN
    RAISE EXCEPTION 'support_workflow_realtime_registration_missing';
  END IF;

  IF (SELECT count(*) FROM public.support_product_workflow_audit
       WHERE entity_id IN (v_thread, v_signal)) < 3 THEN
    RAISE EXCEPTION 'workflow_audit_incomplete';
  END IF;
END;
$test$;

ROLLBACK;
