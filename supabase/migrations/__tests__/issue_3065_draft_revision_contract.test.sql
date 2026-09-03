-- Issue #3065 — the two draft-autosave RPCs must share ONE clientRevision rule.
--
-- They did not. `business_update_event_draft` required the NEW revision
-- (`p_client_revision <> stored + 1` -> reject) while
-- `business_update_rsvp_graph` required the revision the SERVER already held
-- (`__expectedClientRevision <> current` -> reject). The client has one
-- convention — the wizard bumps its counter BEFORE queueing the save — so the
-- RSVP RPC rejected every call it ever received. Proven on production
-- 2026-09-02: `rsvp_domain_operation_receipts` held ZERO rows with
-- operation='update' for all time, and one wedged device put 3,400-4,900
-- `rsvp_revision_conflict` per minute into the database.
--
-- THE RULE, now shared: reject a writer that is BEHIND the stored revision,
-- and only that. Equal is an accepted replay; ahead is an accepted forward
-- save whose value the server adopts (which self-heals a runaway counter).
--
-- Angles the #1977 / #3044 suites do NOT carry:
--   * T-3065-00 the #3065 marker. This is the fails-on-revert anchor: the CI
--     database is built from EVERY migration file, so the pre-#3065 bodies in
--     20270530001977 / 20270615003044 would satisfy a behaviour-only assertion
--     if this migration were deleted.
--   * T-3065-10 the EXACT production call — stored + 1 — must be ACCEPTED.
--     #3044's suite never autosaves twice, so it never sent a bumped revision.
--   * T-3065-11 replay at the same revision is accepted, not a conflict (the
--     wizard's exit-flush resends `latestDraftRef` without re-bumping).
--   * T-3065-12 a writer BEHIND the stored revision is still refused — the
--     guard must not have been widened into a no-op.
--   * T-3065-13 a runaway counter converges in ONE save.
--   * T-3065-20..22 the event-draft RPC obeys the same three, so the two can
--     never silently drift apart again.
--
-- Run after the full migration chain on fresh PostgreSQL 17.
\set ON_ERROR_STOP on
BEGIN;

-- ---------------------------------------------------------------------------
-- T-3065-00 — the #3065 marker, and the #3044 marker it must not have eaten.
-- ---------------------------------------------------------------------------
DO $marker$
BEGIN
  IF COALESCE(obj_description(
       to_regprocedure('public.business_update_rsvp_graph(uuid,jsonb,text,uuid)'),'pg_proc'),'')
     NOT LIKE '%#3065 revision-contract%' THEN
    RAISE EXCEPTION 'T-3065-00 FAIL: business_update_rsvp_graph carries no #3065 marker — the definition present is a pre-#3065 one';
  END IF;
  IF COALESCE(obj_description(
       to_regprocedure('public.business_update_rsvp_graph(uuid,jsonb,text,uuid)'),'pg_proc'),'')
     NOT LIKE '%#3044 db-push-reachable%' THEN
    RAISE EXCEPTION 'T-3065-00 FAIL: the #3044 reachability marker was overwritten by #3065';
  END IF;
  IF COALESCE(obj_description(
       to_regprocedure('public.business_update_event_draft(uuid,jsonb,integer)'),'pg_proc'),'')
     NOT LIKE '%#3065 revision-contract%' THEN
    RAISE EXCEPTION 'T-3065-00 FAIL: business_update_event_draft carries no #3065 marker';
  END IF;
END;
$marker$;

-- ---------------------------------------------------------------------------
-- Fixtures. The brand's account IS the actor, which gives owner rank.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users(id,email)
VALUES('30650000-0000-4000-8000-000000000001','owner-3065@example.test');
INSERT INTO public.creator_accounts(id)
VALUES('30650000-0000-4000-8000-000000000001');
INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
VALUES('30650000-0000-4000-8000-000000000010','30650000-0000-4000-8000-000000000001',
  'Issue 3065 Brand','issue-3065-brand','GBP',now(),now());

-- The autosave payload `eventDrafts.autosaveServerDraft` actually sends for an
-- RSVP draft: draftToServerUpdate's columns plus the top-level
-- `__expectedClientRevision` the wizard has already bumped.
CREATE OR REPLACE FUNCTION pg_temp.issue_3065_rsvp_update_payload(p_revision integer)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $payload$
  SELECT jsonb_build_object(
    'title','Issue 3065 draft',
    'timezone','Europe/London',
    'currency','GBP',
    '__expectedClientRevision',p_revision,
    'theme',jsonb_build_object(
      'business_draft',jsonb_build_object(
        'isRsvp',true,
        'tickets','[]'::jsonb,
        'lastStepReached',1
      )
    )
  )
$payload$;

-- ---------------------------------------------------------------------------
-- T-3065-10..13 — the RSVP owner.
-- ---------------------------------------------------------------------------
DO $rsvp$
DECLARE
  v_event uuid;
  v_stored integer;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','30650000-0000-4000-8000-000000000001',true);

  INSERT INTO public.events(
    id,brand_id,created_by,title,slug,event_type,status,visibility,currency,timezone,
    theme,created_at,updated_at)
  VALUES(
    '30650000-0000-4000-8000-0000000000e1','30650000-0000-4000-8000-000000000010',
    '30650000-0000-4000-8000-000000000001','Issue 3065 draft','issue-3065-draft',
    'rsvp','draft','draft','GBP','Europe/London',
    jsonb_build_object('business_draft',jsonb_build_object(
      'isRsvp',true,'tickets','[]'::jsonb,'clientRevision',39)),
    now(),now())
  RETURNING id INTO v_event;

  -- T-3065-10 — the EXACT production call. The wizard bumped 39 -> 40 before
  -- queueing, so 40 is what arrives. Pre-#3065 this raised on every keystroke.
  PERFORM public.business_update_rsvp_graph(
    v_event, pg_temp.issue_3065_rsvp_update_payload(40), NULL, NULL);
  SELECT (theme#>>'{business_draft,clientRevision}')::integer INTO v_stored
    FROM public.events WHERE id = v_event;
  IF v_stored <> 40 THEN
    RAISE EXCEPTION 'T-3065-10 FAIL: stored revision is % after a stored+1 save, expected 40', v_stored;
  END IF;

  -- T-3065-11 — replay at the same revision (the wizard's exit flush resends
  -- `latestDraftRef` without re-bumping). Accepted, still 40.
  PERFORM public.business_update_rsvp_graph(
    v_event, pg_temp.issue_3065_rsvp_update_payload(40), NULL, NULL);
  SELECT (theme#>>'{business_draft,clientRevision}')::integer INTO v_stored
    FROM public.events WHERE id = v_event;
  IF v_stored <> 40 THEN
    RAISE EXCEPTION 'T-3065-11 FAIL: a same-revision replay moved the stored revision to %', v_stored;
  END IF;

  -- T-3065-12 — a writer BEHIND the stored revision is still refused. Without
  -- this the fix would just be a deleted guard.
  BEGIN
    PERFORM public.business_update_rsvp_graph(
      v_event, pg_temp.issue_3065_rsvp_update_payload(39), NULL, NULL);
    RAISE EXCEPTION 'T-3065-12 FAIL: a stale writer at revision 39 was accepted over stored 40';
  EXCEPTION WHEN serialization_failure THEN
    NULL;  -- rsvp_revision_conflict is raised with ERRCODE 40001
  END;

  -- T-3065-13 — a runaway counter (what production actually had: client at 98,
  -- server frozen at 40) converges in ONE save.
  PERFORM public.business_update_rsvp_graph(
    v_event, pg_temp.issue_3065_rsvp_update_payload(98), NULL, NULL);
  SELECT (theme#>>'{business_draft,clientRevision}')::integer INTO v_stored
    FROM public.events WHERE id = v_event;
  IF v_stored <> 98 THEN
    RAISE EXCEPTION 'T-3065-13 FAIL: stored revision is % after a forward jump, expected 98 — the counters cannot reconverge', v_stored;
  END IF;
END;
$rsvp$;

-- ---------------------------------------------------------------------------
-- T-3065-20..22 — the event owner must obey the SAME three, or the pair drifts
-- apart again and the next wedge lands on ticketed drafts instead.
-- ---------------------------------------------------------------------------
DO $event$
DECLARE
  v_event uuid;
  v_stored integer;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','30650000-0000-4000-8000-000000000001',true);

  INSERT INTO public.events(
    id,brand_id,created_by,title,slug,event_type,status,visibility,currency,timezone,
    theme,created_at,updated_at)
  VALUES(
    '30650000-0000-4000-8000-0000000000e2','30650000-0000-4000-8000-000000000010',
    '30650000-0000-4000-8000-000000000001','Issue 3065 ticketed','issue-3065-ticketed',
    'event','draft','draft','GBP','Europe/London',
    jsonb_build_object('business_draft',jsonb_build_object('clientRevision',7,'requestedVisibility','private')),
    now(),now())
  RETURNING id INTO v_event;

  -- T-3065-20 forward save.
  PERFORM public.business_update_event_draft(
    v_event,
    jsonb_build_object('title','Issue 3065 ticketed','timezone','Europe/London',
      'theme',jsonb_build_object('business_draft',jsonb_build_object('clientRevision',8,'requestedVisibility','private'))),
    8);
  SELECT (theme#>>'{business_draft,clientRevision}')::integer INTO v_stored
    FROM public.events WHERE id = v_event;
  IF v_stored <> 8 THEN
    RAISE EXCEPTION 'T-3065-20 FAIL: stored revision is % after a stored+1 save, expected 8', v_stored;
  END IF;

  -- T-3065-21 same-revision replay is accepted, not a conflict.
  PERFORM public.business_update_event_draft(
    v_event,
    jsonb_build_object('title','Issue 3065 ticketed','timezone','Europe/London',
      'theme',jsonb_build_object('business_draft',jsonb_build_object('clientRevision',8,'requestedVisibility','private'))),
    8);

  -- T-3065-22 a writer behind the stored revision is refused.
  BEGIN
    PERFORM public.business_update_event_draft(
      v_event,
      jsonb_build_object('title','Issue 3065 ticketed','timezone','Europe/London',
        'theme',jsonb_build_object('business_draft',jsonb_build_object('clientRevision',7,'requestedVisibility','private'))),
      7);
    RAISE EXCEPTION 'T-3065-22 FAIL: a stale writer at revision 7 was accepted over stored 8';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'T-3065-22 FAIL%' THEN RAISE; END IF;
  END;
END;
$event$;

ROLLBACK;
