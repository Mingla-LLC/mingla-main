-- #3044 — the RSVP draft graph must be REACHABLE, and it must accept the shape
-- `mingla-business/src/services/eventDrafts.ts` actually sends.
--
-- Companion to `mingla-business/src/services/__tests__/
-- issue_3044_rsvp_draft_rpc_deploy_reachable.test.ts`, which owns the
-- version-shadowing half (that a plain `supabase db push` can reach these
-- definitions at all). This file owns the runtime contract.
--
-- Angles #1977's own test does NOT carry:
--   * T-3044-00 privilege shape asserted for the three DRAFT owners
--     specifically (anon closed, authenticated open, SECURITY DEFINER).
--   * T-3044-01 the #3044 reachability marker. This is the fails-on-revert
--     anchor: a CI database is built from EVERY migration file, so the
--     version-shadowed #1977 definition satisfies any behaviour-only assertion
--     whether or not #3044 exists. The marker is set only by the reachable
--     publish, so deleting 20270615003044 turns this red.
--   * T-3044-02 the REAL client payload — top-level snake_case columns plus a
--     nested `theme.business_draft`, exactly what draftToServerInsert emits.
--     #1977's test passes a FLAT payload, so the nested read path
--     (`COALESCE(p_payload#>'{theme,business_draft}','{}') || p_payload`) was
--     never exercised against the shipped client contract.
--   * T-3044-04 a DIFFERENT p_client_request_id must still create a second row
--     (proves the replay key is the request id, not a blanket brand dedupe).
--   * T-3044-05 hash mismatch under a reused request id.
--   * T-3044-06 RLS negative — an actor with no standing on the brand.
--   * T-3044-07 the created draft is SAVEABLE and a cover video persists, which
--     is the #3040 path-1 consequence issue #3044 names.
--
-- Run after the full migration chain on fresh PostgreSQL 17.
\set ON_ERROR_STOP on
BEGIN;

-- ---------------------------------------------------------------------------
-- T-3044-00 — the three draft owners exist with the right signature, run as
-- SECURITY DEFINER, and are closed to anon.
-- ---------------------------------------------------------------------------
DO $catalog$
DECLARE v_missing text;
BEGIN
  FOREACH v_missing IN ARRAY ARRAY[
    'public.business_create_rsvp_draft_graph(uuid,jsonb,uuid)',
    'public.business_update_rsvp_graph(uuid,jsonb,text,uuid)',
    'public.business_discard_rsvp_draft(uuid,uuid)',
    'public.issue_1977_rsvp_graph(uuid)'
  ] LOOP
    IF to_regprocedure(v_missing) IS NULL THEN
      RAISE EXCEPTION 'T-3044-00 FAIL: % is not defined', v_missing;
    END IF;
    IF has_function_privilege('anon', v_missing, 'EXECUTE') THEN
      RAISE EXCEPTION 'T-3044-00 FAIL: anon can execute %', v_missing;
    END IF;
    IF NOT has_function_privilege('authenticated', v_missing, 'EXECUTE') THEN
      RAISE EXCEPTION 'T-3044-00 FAIL: authenticated cannot execute %', v_missing;
    END IF;
  END LOOP;

  IF NOT (SELECT prosecdef FROM pg_proc
          WHERE oid = to_regprocedure('public.business_create_rsvp_draft_graph(uuid,jsonb,uuid)')) THEN
    RAISE EXCEPTION 'T-3044-00 FAIL: create owner is not SECURITY DEFINER';
  END IF;

  IF to_regclass('public.rsvp_domain_operation_receipts') IS NULL THEN
    RAISE EXCEPTION 'T-3044-00 FAIL: idempotency receipt table is missing';
  END IF;
  IF has_table_privilege('anon','public.rsvp_domain_operation_receipts','SELECT')
     OR has_table_privilege('authenticated','public.rsvp_domain_operation_receipts','SELECT') THEN
    RAISE EXCEPTION 'T-3044-00 FAIL: replay receipts are readable by a client role';
  END IF;
END;
$catalog$;

-- ---------------------------------------------------------------------------
-- T-3044-01 — the #3044 reachability marker. Fails-on-revert anchor.
-- ---------------------------------------------------------------------------
DO $marker$
DECLARE v_target text;
BEGIN
  FOREACH v_target IN ARRAY ARRAY[
    'public.business_create_rsvp_draft_graph(uuid,jsonb,uuid)',
    'public.business_update_rsvp_graph(uuid,jsonb,text,uuid)',
    'public.business_discard_rsvp_draft(uuid,uuid)'
  ] LOOP
    IF COALESCE(obj_description(to_regprocedure(v_target), 'pg_proc'), '') NOT LIKE '%#3044 db-push-reachable%' THEN
      RAISE EXCEPTION
        'T-3044-01 FAIL: % carries no #3044 reachability marker — the only definition present is the version-shadowed 20270530001977 one, which `supabase db push` cannot apply',
        v_target;
    END IF;
  END LOOP;
END;
$marker$;

-- ---------------------------------------------------------------------------
-- Fixtures. Owner administers the brand; the stranger has no standing at all.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users(id,email) VALUES
  ('30440000-0000-4000-8000-000000000001','owner-3044@example.test'),
  ('30440000-0000-4000-8000-000000000002','stranger-3044@example.test');
INSERT INTO public.creator_accounts(id)
VALUES('30440000-0000-4000-8000-000000000001');
INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
VALUES('30440000-0000-4000-8000-000000000010','30440000-0000-4000-8000-000000000001',
  'Issue 3044 Brand','issue-3044-brand','GBP',now(),now());

-- The payload draftToServerInsert actually emits for a freshly promoted RSVP
-- draft: top-level snake_case event columns + the nested theme.business_draft
-- block. Nothing here is hand-flattened.
CREATE OR REPLACE FUNCTION pg_temp.issue_3044_client_insert_payload(p_title text DEFAULT 'Untitled draft')
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $payload$
  SELECT jsonb_build_object(
    'brand_id','30440000-0000-4000-8000-000000000010',
    'created_by','30440000-0000-4000-8000-000000000001',
    'title',p_title,
    'slug','draft-issue-3044',
    'description',NULL,
    'location_text',NULL,
    'online_url',NULL,
    'cover_media_url',NULL,
    'cover_media_poster_url',NULL,
    'cover_media_type',NULL,
    'cover_media_gallery','[]'::jsonb,
    'currency','GBP',
    'is_online',false,
    'is_recurring',false,
    'is_multi_date',false,
    'recurrence_rules',NULL,
    'visibility','draft',
    'status','draft',
    'timezone','Europe/London',
    'theme',jsonb_build_object(
      'coverHue',210,
      'business_draft',jsonb_build_object(
        'schemaVersion',12,
        'legacyLocalDraftId',NULL,
        'format','in_person',
        'partyTypes','[]'::jsonb,
        'vibeTags','[]'::jsonb,
        'musicGenres','[]'::jsonb,
        'city',NULL,
        'locationGeo',NULL,
        'requestedVisibility','private',
        'currency','GBP',
        'whenMode','single',
        'when',jsonb_build_object('date',NULL,'doorsOpen',NULL,'endsAt',NULL,'timezone','Europe/London'),
        'location',jsonb_build_object('venueName',NULL,'address',NULL),
        'tickets','[]'::jsonb,
        'settings',jsonb_build_object(
          'requireApproval',false,'allowTransfers',false,'hideRemainingCount',false,
          'passwordProtected',false,'privateGuestList',false,'inPersonPaymentsEnabled',false),
        'isRsvp',true,
        'rsvpCapacity',NULL,
        'rsvpAllowPlusOnes',false,
        'rsvpPlusOnesMax',0,
        'rsvpWaitlistEnabled',false,
        'rsvpApprovalMode','auto',
        'rsvpDiscoverable',false,
        'rsvpContributionEnabled',false,
        'rsvpContributionSuggestedCents',NULL,
        'rsvpContributionMinCents',NULL,
        'lastStepReached',0,
        'clientRevision',0
      )
    )
  )
$payload$;

-- ---------------------------------------------------------------------------
-- T-3044-02 / 03 / 04 / 05 — create, graph shape, event_type, replay.
-- ---------------------------------------------------------------------------
DO $create_replay$
DECLARE v_create jsonb; v_replay jsonb; v_other jsonb; v_event uuid; v_row public.events%ROWTYPE;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','30440000-0000-4000-8000-000000000001',true);

  v_create := public.business_create_rsvp_draft_graph(
    '30440000-0000-4000-8000-000000000010',
    pg_temp.issue_3044_client_insert_payload(),
    '30440000-0000-4000-8000-0000000000a1');

  v_event := (v_create->'event'->>'id')::uuid;
  IF v_event IS NULL THEN
    RAISE EXCEPTION 'T-3044-02 FAIL: create returned no event: %', v_create;
  END IF;

  -- eventFromRsvpGraph reads `.event`; publishRsvpDraft reads `.brand.id`;
  -- updateLiveRsvp reads `.updateResult`. The graph is genuinely multi-table,
  -- which is why this path can NOT be collapsed into business_create_event_draft.
  IF NOT (v_create ? 'event' AND v_create ? 'brand' AND v_create ? 'eventDates' AND v_create ? 'clientRevision')
     OR (v_create->'brand'->>'id') <> '30440000-0000-4000-8000-000000000010'
     OR (v_create->'brand'->>'currency') <> 'GBP' THEN
    RAISE EXCEPTION 'T-3044-02 FAIL: graph shape is not the one eventFromRsvpGraph consumes: %', v_create;
  END IF;

  SELECT * INTO v_row FROM public.events WHERE id = v_event;
  -- ORCH-1150 D-2: a row created as 'event' binds the cover-video pipeline to
  -- the wrong discriminator and RSVP video covers never persist.
  IF v_row.event_type <> 'rsvp' THEN
    RAISE EXCEPTION 'T-3044-02 FAIL: draft row is event_type=% (ORCH-1150 D-2 discriminator lost)', v_row.event_type;
  END IF;
  IF v_row.status <> 'draft' OR v_row.visibility <> 'draft' OR v_row.currency <> 'GBP' THEN
    RAISE EXCEPTION 'T-3044-02 FAIL: draft lifecycle columns are wrong: % / % / %',
      v_row.status, v_row.visibility, v_row.currency;
  END IF;
  IF (v_row.theme#>>'{business_draft,isRsvp}') <> 'true' THEN
    RAISE EXCEPTION 'T-3044-02 FAIL: nested theme.business_draft was not read from the client payload: %', v_row.theme;
  END IF;
  IF v_create->>'replayed' <> 'false' THEN
    RAISE EXCEPTION 'T-3044-02 FAIL: first create reported replayed=true';
  END IF;

  -- T-3044-03 same request id → same row, no duplicate.
  v_replay := public.business_create_rsvp_draft_graph(
    '30440000-0000-4000-8000-000000000010',
    pg_temp.issue_3044_client_insert_payload(),
    '30440000-0000-4000-8000-0000000000a1');
  IF v_replay->>'replayed' <> 'true'
     OR (v_replay->'event'->>'id')::uuid <> v_event
     OR (SELECT count(*) FROM public.events WHERE brand_id='30440000-0000-4000-8000-000000000010') <> 1 THEN
    RAISE EXCEPTION 'T-3044-03 FAIL: replay on the same p_client_request_id was not idempotent: %', v_replay;
  END IF;

  -- T-3044-04 a different request id is a genuinely new draft.
  v_other := public.business_create_rsvp_draft_graph(
    '30440000-0000-4000-8000-000000000010',
    pg_temp.issue_3044_client_insert_payload(),
    '30440000-0000-4000-8000-0000000000a2');
  IF v_other->>'replayed' <> 'false'
     OR (v_other->'event'->>'id')::uuid = v_event
     OR (SELECT count(*) FROM public.events WHERE brand_id='30440000-0000-4000-8000-000000000010') <> 2 THEN
    RAISE EXCEPTION 'T-3044-04 FAIL: a fresh p_client_request_id did not create a second draft: %', v_other;
  END IF;

  -- T-3044-05 same request id, different payload → refuse, never silently
  -- return the old row for a new request.
  BEGIN
    PERFORM public.business_create_rsvp_draft_graph(
      '30440000-0000-4000-8000-000000000010',
      pg_temp.issue_3044_client_insert_payload('A different title'),
      '30440000-0000-4000-8000-0000000000a1');
    RAISE EXCEPTION 'T-3044-05 FAIL: reused request id with a changed payload was accepted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  PERFORM set_config('issue3044.event_id', v_event::text, true);
END;
$create_replay$;

-- ---------------------------------------------------------------------------
-- T-3044-06 — RLS negative. An actor with no standing on the brand.
-- ---------------------------------------------------------------------------
DO $forbidden$
BEGIN
  PERFORM set_config('request.jwt.claim.sub','30440000-0000-4000-8000-000000000002',true);
  BEGIN
    PERFORM public.business_create_rsvp_draft_graph(
      '30440000-0000-4000-8000-000000000010',
      pg_temp.issue_3044_client_insert_payload(),
      '30440000-0000-4000-8000-0000000000b1');
    RAISE EXCEPTION 'T-3044-06 FAIL: a stranger created a draft under a brand they do not administer';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  IF (SELECT count(*) FROM public.events WHERE brand_id='30440000-0000-4000-8000-000000000010') <> 2 THEN
    RAISE EXCEPTION 'T-3044-06 FAIL: the forbidden call still wrote a row';
  END IF;
END;
$forbidden$;

-- ---------------------------------------------------------------------------
-- T-3044-07 — the created draft is SAVEABLE, and a cover video persists.
-- This is the consequence issue #3044 names: with no reachable draft owner an
-- RSVP event can never receive a cover video during creation.
-- ---------------------------------------------------------------------------
DO $saveable$
DECLARE v_event uuid := current_setting('issue3044.event_id')::uuid; v_update jsonb; v_row public.events%ROWTYPE;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','30440000-0000-4000-8000-000000000001',true);
  v_update := public.business_update_rsvp_graph(
    v_event,
    jsonb_build_object(
      'title','Rooftop RSVP',
      'cover_media_url','https://video.bunnycdn.test/issue-3044/cover.mp4',
      'cover_media_poster_url','https://video.bunnycdn.test/issue-3044/poster.jpg',
      'cover_media_type','video',
      '__expectedClientRevision',0),
    NULL,
    '30440000-0000-4000-8000-0000000000c1');

  SELECT * INTO v_row FROM public.events WHERE id = v_event;
  IF v_row.cover_media_url <> 'https://video.bunnycdn.test/issue-3044/cover.mp4'
     OR v_row.cover_media_type <> 'video'
     OR v_row.title <> 'Rooftop RSVP' THEN
    RAISE EXCEPTION 'T-3044-07 FAIL: RSVP draft could not be saved with a cover video: %', to_jsonb(v_row);
  END IF;
  IF v_row.event_type <> 'rsvp' THEN
    RAISE EXCEPTION 'T-3044-07 FAIL: autosave changed the discriminator to %', v_row.event_type;
  END IF;
  IF (v_update->'event'->>'cover_media_url') IS NULL THEN
    RAISE EXCEPTION 'T-3044-07 FAIL: autosave graph did not echo the saved cover: %', v_update;
  END IF;
END;
$saveable$;

ROLLBACK;
