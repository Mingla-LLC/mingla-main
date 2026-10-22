\set ON_ERROR_STOP on

-- Issue #4064 — the two proven stale-save paths are ordinary HTTP conflicts,
-- preserve their message contracts, and cannot change the rejected row.
-- Run after the full migration chain on PostgreSQL 17.
-- MINGLA-INVARIANT: I-4064-STALE-SAVES-RETURN-ONCE | issue #4064 | The Work-card and RSVP-graph optimistic-concurrency conflicts use PT409, preserve their existing message tokens, and leave the rejected row unchanged.

BEGIN;

DO $test$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_sprint uuid := gen_random_uuid();
  v_card uuid := gen_random_uuid();
  v_before jsonb;
  v_after jsonb;
  v_state text;
  v_message text;
  v_src text;
BEGIN
  SELECT prosrc INTO v_src
    FROM pg_catalog.pg_proc
   WHERE oid = 'public.ops_card_lock(uuid, bigint)'::pg_catalog.regprocedure;
  IF pg_catalog.strpos(v_src, 'PT409') = 0 OR pg_catalog.strpos(v_src, '40001') > 0 THEN
    RAISE EXCEPTION 'ISSUE-4064 FAIL: ops_card_lock is not pinned to PT409';
  END IF;

  INSERT INTO public.ops_sprints(id, starts_on, goal)
  VALUES (v_sprint, DATE '2099-01-05', 'Issue 4064 stale conflict fixture');
  INSERT INTO public.ops_work_cards(
    id, title, instructions, done_means, due_on, due_source, sprint_id,
    created_by, updated_by, revision)
  VALUES (
    v_card, 'Issue 4064 Work card',
    'Keep the stale-write fixture deterministic.',
    'The stale call changes nothing.', DATE '2099-01-06', 'explicit', v_sprint,
    'issue4064@example.test', 'issue4064@example.test', 7);

  SELECT to_jsonb(w) INTO v_before FROM public.ops_work_cards AS w WHERE w.id = v_card;
  BEGIN
    PERFORM public.ops_card_lock(v_card, 6);
    RAISE EXCEPTION 'ISSUE-4064 FAIL: stale Work-card revision was accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
  END;
  IF v_state IS DISTINCT FROM 'PT409'
     OR v_message IS DISTINCT FROM 'stale_write: This card changed since you opened it. Reload it, then try again.' THEN
    RAISE EXCEPTION 'ISSUE-4064 FAIL: Work-card conflict returned % / %', v_state, v_message;
  END IF;
  SELECT to_jsonb(w) INTO v_after FROM public.ops_work_cards AS w WHERE w.id = v_card;
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'ISSUE-4064 FAIL: the refused Work-card save changed the row';
  END IF;

  INSERT INTO auth.users(id, email)
  VALUES (v_user, 'issue4064-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  VALUES (v_brand, v_user, 'Issue 4064 Brand', 'issue-4064-' || v_brand, 'USD');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  INSERT INTO public.events(
    id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, theme)
  VALUES (
    v_event, v_brand, v_user, 'Issue 4064 RSVP', 'issue-4064-rsvp-' || v_event,
    'rsvp', 'draft', 'draft', 'UTC', 'USD',
    jsonb_build_object('business_draft', jsonb_build_object(
      'isRsvp', true, 'tickets', '[]'::jsonb, 'clientRevision', 5)));

  SELECT to_jsonb(e) INTO v_before FROM public.events AS e WHERE e.id = v_event;
  v_state := NULL;
  v_message := NULL;
  BEGIN
    PERFORM public.business_update_rsvp_graph(
      v_event,
      jsonb_build_object(
        '__expectedClientRevision', 2,
        'title', 'A stale title that must not win',
        'theme', jsonb_build_object('business_draft', jsonb_build_object(
          'isRsvp', true, 'tickets', '[]'::jsonb, 'clientRevision', 2))),
      NULL,
      NULL);
    RAISE EXCEPTION 'ISSUE-4064 FAIL: stale RSVP revision was accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
  END;
  IF v_state IS DISTINCT FROM 'PT409'
     OR v_message IS DISTINCT FROM 'rsvp_revision_conflict' THEN
    RAISE EXCEPTION 'ISSUE-4064 FAIL: RSVP conflict returned % / %', v_state, v_message;
  END IF;
  SELECT to_jsonb(e) INTO v_after FROM public.events AS e WHERE e.id = v_event;
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'ISSUE-4064 FAIL: the refused RSVP save changed the row';
  END IF;

  RAISE NOTICE 'ISSUE-4064 PASS: both stale-save paths return PT409 once and preserve their rows';
END
$test$;

ROLLBACK;
